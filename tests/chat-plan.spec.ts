import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { rest, rpc, runTag, type Session, signIn, stackKeys } from "./support/local-stack";

/**
 * Chat v2 CV-4 · "paused and grants" (AC2.1, AC2.8, AC10.8), at the API against
 * the local stack: a lapsed plan keeps every conversation readable and
 * searchable and refuses sends; a dated grant turns chat on in a Free owner's
 * workspace (General and a first post) and its end pauses it the same way;
 * without TX-9b's grant function the owner's plan decides.
 *   scripts/agent/e2e.sh tests/chat-plan.spec.ts
 * It needs …_chat_v2_plan_source.sql applied. Its two people (plan-owner@ and
 * plan-member@moduo.local) work in a workspace it makes and removes.
 *
 * TX-9b's function, public.plan_grant_effective_tier(uuid), is played by a
 * throwaway stub created with psql and dropped at the end (only a stub this
 * spec marked; a real one, once TX-9b lands, is never replaced: the grant half
 * then skips). The UI half (the paused line replacing the composer, a refused
 * send turning into "Not sent · Retry") is CV-8a's; the v2 Home widgets and MCP
 * read tools are CV-22's and CV-21's.
 */

test.describe.configure({ mode: "serial", timeout: 120_000 });

const OWNER = { email: "plan-owner@moduo.local", password: "localplanowner", name: "Pia Owner" };
const MEMBER = {
  email: "plan-member@moduo.local",
  password: "localplanmember",
  name: "Max Member",
};
const STUB_MARK = "chat-plan.spec stub";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let owner: Session;
let member: Session;
let ws: string;
let general: string;
let tag: string;
let realGrantFunction = false;

/** A throwaway person, created once (the stack blanks passwords on insert). */
async function ensurePerson(who: typeof OWNER): Promise<Session> {
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
  await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers: admin,
    body: JSON.stringify({ password: who.password }),
  });
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

const isStubOrAbsent = `coalesce(obj_description(to_regprocedure('public.plan_grant_effective_tier(uuid)'), 'pg_proc'), '${STUB_MARK}') = '${STUB_MARK}'`;

/** The stub: workspace `grantWs` holds a Team grant until `endsAt`. Never replaces a real function. */
function installGrantStub(grantWs: string, endsAt: Date): void {
  if (!UUID.test(grantWs)) throw new Error(`not a workspace id: ${grantWs}`);
  psql(`DO $do$
BEGIN
  IF NOT (${isStubOrAbsent}) THEN
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

/** Drop the stub (only one this spec marked). */
function dropGrantStub(): void {
  psql(`DO $do$
BEGIN
  IF to_regprocedure('public.plan_grant_effective_tier(uuid)') IS NOT NULL AND ${isStubOrAbsent} THEN
    DROP FUNCTION public.plan_grant_effective_tier(uuid);
  END IF;
END;
$do$;`);
}

async function setOwnerPlan(tier: "free" | "duo"): Promise<void> {
  await rest("service", `profiles?id=eq.${owner.user.id}`, {
    method: "PATCH",
    body: { plan_tier: tier },
  });
}

const enabled = (as: Session) => rpc<boolean>(as, "chat_workspace_enabled", { p_workspace_id: ws });

const send = (body: string) =>
  rpc(member, "chat_op_send", {
    p_channel_id: general,
    p_body: body,
    p_parent_id: null,
    p_mentioned_user_ids: [],
    p_notify_channel: false,
    p_client_id: null,
    p_excerpt: null,
  });

/** Everything a paused workspace must still answer: the conversation, its messages, search. */
async function expectReadable(word: string): Promise<void> {
  const channels = await rest<Array<{ id: string }>>(
    member,
    `chat_channels?workspace_id=eq.${ws}&select=id`,
  );
  expect(channels.map((c) => c.id)).toContain(general);
  const messages = await rest<Array<{ body: string }>>(
    member,
    `chat_messages?channel_id=eq.${general}&select=body&order=created_at.asc`,
  );
  expect(messages.some((m) => m.body.includes(word))).toBe(true);
  const v2Search = await rest<unknown[]>(
    member,
    `chat_messages?workspace_id=eq.${ws}&search_tsv=fts(simple).${word}&select=id`,
  );
  expect(v2Search).toHaveLength(1);
  const v1Search = await rest<unknown[]>(
    member,
    `chat_messages?workspace_id=eq.${ws}&body=ilike.*${word}*&deleted_at=is.null&select=id`,
  );
  expect(v1Search).toHaveLength(1);
}

/** A send the server refuses (the plan), with nothing written. */
async function expectSendRefused(body: string): Promise<void> {
  await expect(send(body)).rejects.toThrow(/rpc\/chat_op_send: 4\d\d /);
  const written = await rest<unknown[]>(
    member,
    `chat_messages?channel_id=eq.${general}&body=eq.${encodeURIComponent(body)}&select=id`,
  );
  expect(written).toHaveLength(0);
}

test.beforeAll(async () => {
  owner = await ensurePerson(OWNER);
  member = await ensurePerson(MEMBER);
  tag = runTag();
  realGrantFunction =
    psql(
      `SELECT to_regprocedure('public.plan_grant_effective_tier(uuid)') IS NOT NULL AND NOT (${isStubOrAbsent})`,
    ) === "t";
  dropGrantStub(); // a run that stopped half-way must not leave a grant behind
  await setOwnerPlan("duo");
  // A run that stopped half-way leaves its workspace; the Free plan allows one.
  await rest("service", `workspaces?owner_id=eq.${owner.user.id}&deleted_at=is.null`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
  });
  const [created] = await rest<Array<{ id: string }>>(owner, "workspaces", {
    method: "POST",
    body: { name: `Chat plan ${tag}`, owner_id: owner.user.id },
  });
  ws = created.id;
  await rest("service", "workspace_members", {
    method: "POST",
    body: { workspace_id: ws, user_id: member.user.id, role: "member" },
  });
  await rpc(member, "chat_op_bootstrap", { p_workspace_id: ws });
  const [row] = await rest<Array<{ id: string }>>(
    member,
    `chat_channels?workspace_id=eq.${ws}&name=eq.general&select=id`,
  );
  general = row.id;
});

test.afterAll(async () => {
  dropGrantStub();
  if (owner) await setOwnerPlan("free");
  if (!ws) return;
  await rest("service", `workspaces?id=eq.${ws}`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
  });
});

test.describe("paused and grants", () => {
  test("a lapsed plan keeps reading and search, refuses sends; the owner's plan decides", async () => {
    const word = `lapsecheck${tag}`;
    expect(await enabled(member)).toBe(true);
    await send(`Before the lapse ${word}`);

    await setOwnerPlan("free");
    expect(await enabled(member)).toBe(false);
    expect(await enabled(owner)).toBe(false);
    await expectReadable(word);
    await expectSendRefused(`After the lapse ${tag}`);

    await setOwnerPlan("duo");
    expect(await enabled(member)).toBe(true);
    await send(`Back on ${tag}`);
    await setOwnerPlan("free");
  });

  test("a dated grant turns chat on in a Free owner's workspace, and its end pauses it", async () => {
    test.skip(
      realGrantFunction,
      "TX-9b's plan_grant_effective_tier is installed: its grants are made by its own ops, not this spec's stub",
    );
    const word = `grantcheck${tag}`;
    await setOwnerPlan("free");
    expect(await enabled(member)).toBe(false);

    // AC2.1: a handed-out Team workspace has chat, with General.
    installGrantStub(ws, new Date(Date.now() + 60 * 60 * 1000));
    expect(await enabled(member)).toBe(true);
    await rpc(member, "chat_op_bootstrap", { p_workspace_id: ws });
    const generals = await rest<unknown[]>(
      member,
      `chat_channels?workspace_id=eq.${ws}&name=eq.general&select=id`,
    );
    expect(generals).toHaveLength(1);
    await send(`Kickoff ${word}`);

    // AC2.8, AC10.8: the grant ends; everything stays readable, sends are refused.
    installGrantStub(ws, new Date(Date.now() - 60 * 1000));
    expect(await enabled(member)).toBe(false);
    await expectReadable(word);
    await expectSendRefused(`After the grant ${tag}`);

    // Without TX-9b's function the owner's plan decides again.
    dropGrantStub();
    expect(await enabled(member)).toBe(false);
    await expectReadable(word);
    await setOwnerPlan("duo");
    expect(await enabled(member)).toBe(true);
    await setOwnerPlan("free");
  });
});
