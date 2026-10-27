import { rest, rpc, type Session, setLocalPassword, signIn, stackKeys } from "./local-stack";

/**
 * A chat room of its own for a spec (CV-7a): two throwaway people and a
 * workspace whose owner pays for Duo, with General made, so a spec never
 * leans on the dev seed person's workspace (a reset leaves it with none).
 * The people are created once and reused; the workspace is new each run and
 * the owner's earlier ones are soft-deleted first (the plan allows few).
 */

export type ChatPersonSeed = { email: string; password: string; name: string };
export type ChatRoom = { owner: Session; member: Session; ws: string; general: string };

/** A throwaway person, created once (the stack blanks passwords on insert). */
export async function ensureChatPerson(who: ChatPersonSeed): Promise<Session> {
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

/** A new Duo workspace of `owner`'s with `member` in it and General made. */
export async function makeChatRoom(
  ownerSeed: ChatPersonSeed,
  memberSeed: ChatPersonSeed,
  name: string,
): Promise<ChatRoom> {
  const owner = await ensureChatPerson(ownerSeed);
  const member = await ensureChatPerson(memberSeed);
  await rest("service", `profiles?id=eq.${owner.user.id}`, {
    method: "PATCH",
    body: { plan_tier: "duo" },
  });
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
  await rpc(owner, "chat_op_bootstrap", { p_workspace_id: created.id });
  await rpc(member, "chat_op_bootstrap", { p_workspace_id: created.id });
  const generals = await rest<Array<{ id: string }>>(
    owner,
    `chat_channels?workspace_id=eq.${created.id}&is_default=is.true&select=id`,
  );
  const general = generals[0]?.id;
  if (!general) throw new Error("General wasn't made");
  return { owner, member, ws: created.id, general };
}

/**
 * Send a v2 message as someone; returns its id. Your own send reads the
 * conversation through (closes your Catch up items there), and so does opening
 * it: to seed someone's Catch up, send as the other person and check the list
 * before opening the conversation.
 */
export async function sendAs(
  who: Session,
  channelId: string,
  body: string,
  replyToId: string | null = null,
): Promise<string> {
  const row = await rpc<{ id: string } | Array<{ id: string }>>(who, "chat_op_send", {
    p_id: crypto.randomUUID(),
    p_channel_id: channelId,
    p_body: body,
    p_reply_to_id: replyToId,
  });
  const one = Array.isArray(row) ? row[0] : row;
  if (!one?.id) throw new Error("send returned no row");
  return one.id;
}

/**
 * Write history straight into the table as the service role (the send op
 * limits how fast one person sends). Rows are stamped `minutesAgo` back, so
 * a spec can lay down days of history; `body` is the v2 stored form.
 */
export async function seedHistory(
  room: ChatRoom,
  rows: Array<{ author: Session; body: string; minutesAgo: number }>,
): Promise<string[]> {
  const now = Date.now();
  const payload = rows.map((r) => ({
    id: crypto.randomUUID(),
    workspace_id: room.ws,
    channel_id: room.general,
    author_id: r.author.user.id,
    author_kind: "user",
    body: r.body,
    format_version: 2,
    kind: "message",
    created_at: new Date(now - r.minutesAgo * 60_000).toISOString(),
  }));
  for (let i = 0; i < payload.length; i += 500) {
    await rest("service", "chat_messages", {
      method: "POST",
      body: payload.slice(i, i + 500),
      prefer: "return=minimal",
    });
  }
  return payload.map((p) => p.id);
}

/** Soft-delete the room's workspace at the end of a run. */
export async function removeChatRoom(room: ChatRoom | undefined): Promise<void> {
  if (!room) return;
  await rest("service", `workspaces?id=eq.${room.ws}`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
  });
}
