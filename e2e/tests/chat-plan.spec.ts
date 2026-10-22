import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import {
  rest,
  rpc,
  runTag,
  type Session,
  setLocalPassword,
  signIn,
  stackKeys,
} from "./support/local-stack";

/**
 * Chat v2 CV-4 · "paused and grants" (AC2.1, AC2.8, AC10.8), at the API against
 * the local stack: a lapsed plan keeps every conversation readable and
 * searchable and refuses sends; a dated grant turns chat on in a Free owner's
 * workspace (General is made under the grant, a first post) and its end pauses
 * it the same way; without TX-9b's grant function the owner's plan decides.
 *   scripts/agent/e2e.sh tests/chat-plan.spec.ts
 * It needs …_chat_v2_plan_source.sql applied. Its three people (plan-owner@,
 * plan-grantee@ and plan-member@moduo.local) work in two workspaces it makes
 * and removes: one whose owner pays (then lapses), one handed out by a grant.
 *
 * TX-9b's function, public.plan_grant_effective_tier(uuid), is played by a
 * throwaway stub created with psql and dropped at the end. Only a function
 * carrying this spec's comment is ever replaced or dropped; a real one (TX-9b
 * landed) is left alone and the grant test skips. The UI half (the paused line
 * replacing the composer, a refused send turning into "Not sent · Retry") is
 * CV-8a's; the v2 Home widgets and MCP read tools are CV-22's and CV-21's.
 */

test.describe.configure({ mode: "serial", timeout: 120_000 });

type Person = { email: string; password: string; name: string };
const OWNER: Person = {
  email: "plan-owner@moduo.local",
  password: "localplanowner",
  name: "Pia Owner",
};
const GRANTEE: Person = {
  email: "plan-grantee@moduo.local",
  password: "localplangrantee",
  name: "Gus Grantee",
};
const MEMBER: Person = {
  email: "plan-member@moduo.local",
  password: "localplanmember",
  name: "Max Member",
};
const STUB_MARK = "chat-plan.spec stub";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A workspace of this spec: its owner, its id, and General once it exists. */
type Room = { owner: Session; ws: string; general: string };

let member: Session;
let paid: Room;
let granted: Room;
let tag: string;
let realGrantFunction = false;

/** A throwaway person, created once (the stack blanks passwords on insert). */
async function ensurePerson(who: Person): Promise<Session> {
  const { url, service } = stackKeys();
  const admin = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    "Content-Type": "application/json",
  };
  const list = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers: admin });
  const users = ((await list.json()) as { users: Array<{ id: string; email: string }> }).users;
  let user = users.find((u) => u.email === who.email);
  if (!user) {
    const created = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        email: who.email,
        email_confirm: true,
        user_metadata: { full_name: who.name, display_name: who.name },
      }),
    });
    user = (await created.json()) as { id: string; email: string };
  }
  // Auth refuses password writes; set it in SQL (supabase/seed.sql does the same).
  setLocalPassword(user.id, who.password);
  await rest("service", `profiles?id=eq.${user.id}`, {
    method: "PATCH",
    body: { display_name: who.name },
  });
  return signIn(who);
}

/** psql against the local stack (DDL for the stub; PostgREST can't). */
function psql(sql: string): string {
  const dbUrl =
    process.env.MODUO_DB_URL ??
    (
      JSON.parse(
        execFileSync("supabase", ["status", "-o", "json"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }),
      ) as { DB_URL?: string }
    ).DB_URL;
  if (!dbUrl?.includes("127.0.0.1"))
    throw new Error("This spec runs against the local stack only.");
  return execFileSync("psql", [dbUrl, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
  }).trim();
}

const GRANT_FN = "to_regprocedure('public.plan_grant_effective_tier(uuid)')";
/** True only for this spec's stub: a real function, commented or not, never matches. */
const IS_STUB = `obj_description(${GRANT_FN}, 'pg_proc') IS NOT DISTINCT FROM '${STUB_MARK}' AND ${GRANT_FN} IS NOT NULL`;

/** The stub: workspace `grantWs` holds a Team grant until `endsAt`. Never replaces a real function. */
function installGrantStub(grantWs: string, endsAt: Date): void {
  if (!UUID.test(grantWs)) throw new Error(`not a workspace id: ${grantWs}`);
  psql(`DO $do$
BEGIN
  IF ${GRANT_FN} IS NOT NULL AND NOT (${IS_STUB}) THEN
    RAISE EXCEPTION 'public.plan_grant_effective_tier(uuid) is a real function here; not replacing it';
  END IF;
  CREATE OR REPLACE FUNCTION public.plan_grant_effective_tier(p_workspace_id uuid) RETURNS text
  LANGUAGE sql STABLE SET search_path = '' AS $f$
    SELECT 'team' WHERE p_workspace_id = '${grantWs}'::uuid AND now() < '${endsAt.toISOString()}'::timestamptz
  $f$;
  COMMENT ON FUNCTION public.plan_grant_effective_tier(uuid) IS '${STUB_MARK}';
  REVOKE ALL ON FUNCTION public.plan_grant_effective_tier(uuid) FROM PUBLIC, anon, authenticated;
END;
$do$;`);
}

/** Drop the stub (only a function carrying this spec's comment). */
function dropGrantStub(): void {
  psql(`DO $do$
BEGIN
  IF ${IS_STUB} THEN
    DROP FUNCTION public.plan_grant_effective_tier(uuid);
  END IF;
END;
$do$;`);
}

async function setPlan(who: Session, tier: "free" | "duo"): Promise<void> {
  await rest("service", `profiles?id=eq.${who.user.id}`, {
    method: "PATCH",
    body: { plan_tier: tier },
  });
}

/** A new workspace of `owner`'s with the member in it (a stopped run's workspace is removed first). */
async function makeRoom(owner: Session, name: string): Promise<Room> {
  // The Free plan allows one workspace.
  await rest("service", `workspaces?owner_id=eq.${owner.user.id}&deleted_at=is.null`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
  });
  const [created] = await rest<Array<{ id: string }>>(owner, "workspaces", {
    method: "POST",
    body: { name, owner_id: owner.user.id },
  });
  await rest("service", "workspace_members", {
    method: "POST",
    body: { workspace_id: created.id, user_id: member.user.id, role: "member" },
  });
  return { owner, ws: created.id, general: "" };
}

/** The member opens chat in the room (makes General) and returns General's id. */
async function bootstrap(room: Room): Promise<string> {
  await rpc(member, "chat_op_bootstrap", { p_workspace_id: room.ws });
  const generals = await rest<Array<{ id: string }>>(
    member,
    `chat_channels?workspace_id=eq.${room.ws}&is_default=is.true&select=id`,
  );
  expect(generals).toHaveLength(1);
  return generals[0].id;
}

async function generalCount(room: Room): Promise<number> {
  const rows = await rest<unknown[]>(
    "service",
    `chat_channels?workspace_id=eq.${room.ws}&is_default=is.true&select=id`,
  );
  return rows.length;
}

const enabled = (as: Session, room: Room) =>
  rpc<boolean>(as, "chat_workspace_enabled", { p_workspace_id: room.ws });

const send = (room: Room, body: string) =>
  rpc(member, "chat_op_send", {
    p_id: crypto.randomUUID(),
    p_channel_id: room.general,
    p_body: body,
    p_reply_to_id: null,
  });

/** Everything a paused workspace must still answer: the conversation, its messages, search. */
async function expectReadable(room: Room, word: string): Promise<void> {
  const channels = await rest<Array<{ id: string }>>(
    member,
    `chat_channels?workspace_id=eq.${room.ws}&select=id`,
  );
  expect(channels.map((c) => c.id)).toContain(room.general);
  const messages = await rest<Array<{ body: string }>>(
    member,
    `chat_messages?channel_id=eq.${room.general}&select=body&order=created_at.asc`,
  );
  expect(messages.some((m) => m.body.includes(word))).toBe(true);
  const v2Search = await rest<unknown[]>(
    member,
    `chat_messages?workspace_id=eq.${room.ws}&search_tsv=fts(simple).${word}&select=id`,
  );
  expect(v2Search).toHaveLength(1);
  const v1Search = await rest<unknown[]>(
    member,
    `chat_messages?workspace_id=eq.${room.ws}&body=ilike.*${word}*&deleted_at=is.null&select=id`,
  );
  expect(v1Search).toHaveLength(1);
}

/** A send the server refuses (the plan), with nothing written. */
async function expectSendRefused(room: Room, body: string): Promise<void> {
  await expect(send(room, body)).rejects.toThrow(/rpc\/chat_op_send: 4\d\d /);
  const written = await rest<unknown[]>(
    member,
    `chat_messages?channel_id=eq.${room.general}&body=eq.${encodeURIComponent(body)}&select=id`,
  );
  expect(written).toHaveLength(0);
}

test.beforeAll(async () => {
  const owner = await ensurePerson(OWNER);
  const grantee = await ensurePerson(GRANTEE);
  member = await ensurePerson(MEMBER);
  tag = runTag();
  realGrantFunction = psql(`SELECT ${GRANT_FN} IS NOT NULL AND NOT (${IS_STUB})`) === "t";
  dropGrantStub(); // a run that stopped half-way must not leave a grant behind

  await setPlan(owner, "duo");
  paid = await makeRoom(owner, `Chat plan ${tag}`);
  paid.general = await bootstrap(paid);

  await setPlan(grantee, "free");
  granted = await makeRoom(grantee, `Chat grant ${tag}`);
});

test.afterAll(async () => {
  dropGrantStub();
  for (const room of [paid, granted]) {
    if (!room) continue;
    await setPlan(room.owner, "free");
    await rest("service", `workspaces?id=eq.${room.ws}`, {
      method: "PATCH",
      body: { deleted_at: new Date().toISOString() },
    });
  }
});

test.describe("paused and grants", () => {
  test("a lapsed plan keeps reading and search, refuses sends; the owner's plan decides", async () => {
    const word = `lapsecheck${tag}`;
    expect(await enabled(member, paid)).toBe(true);
    await send(paid, `Before the lapse ${word}`);

    await setPlan(paid.owner, "free");
    expect(await enabled(member, paid)).toBe(false);
    expect(await enabled(paid.owner, paid)).toBe(false);
    await expectReadable(paid, word);
    await expectSendRefused(paid, `After the lapse ${tag}`);

    await setPlan(paid.owner, "duo");
    expect(await enabled(member, paid)).toBe(true);
    await send(paid, `Back on ${tag}`);
    await setPlan(paid.owner, "free");
  });

  test("a dated grant turns chat on in a Free owner's workspace, and its end pauses it", async () => {
    test.skip(
      realGrantFunction,
      "TX-9b's plan_grant_effective_tier is installed: its grants are made by its own ops, not this spec's stub",
    );
    const word = `grantcheck${tag}`;
    expect(await enabled(member, granted)).toBe(false);
    expect(await generalCount(granted)).toBe(0);

    // AC2.1: a handed-out Team workspace has chat: General is made under the grant.
    installGrantStub(granted.ws, new Date(Date.now() + 60 * 60 * 1000));
    expect(await enabled(member, granted)).toBe(true);
    expect(await enabled(granted.owner, granted)).toBe(true);
    granted.general = await bootstrap(granted);
    await send(granted, `Kickoff ${word}`);
    // Only the granted workspace: the lapsed one stays paused.
    expect(await enabled(member, paid)).toBe(false);

    // AC2.8, AC10.8: the grant ends; everything stays readable, sends are refused.
    installGrantStub(granted.ws, new Date(Date.now() - 60 * 1000));
    expect(await enabled(member, granted)).toBe(false);
    await expectReadable(granted, word);
    await expectSendRefused(granted, `After the grant ${tag}`);

    // Without TX-9b's function the owner's plan decides again.
    dropGrantStub();
    expect(await enabled(member, granted)).toBe(false);
    await expectReadable(granted, word);
    await setPlan(granted.owner, "duo");
    expect(await enabled(member, granted)).toBe(true);
    await setPlan(granted.owner, "free");
  });
});
