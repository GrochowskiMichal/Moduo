// CV-0 spike 2, pass bar 5: losing access sends no event (a row RLS stops
// returning is never delivered), so the store's access check must find it.
// SQL (spike_s2, the draft chat_sync_ids) → the store in a real Chromium →
// IndexedDB, for each case of round-3 §2.7:
//   removed        a private channel's member row stamped left_at
//   deleted        a channel stamped deleted_at (its member rows touched)
//   made private   a public channel you read without joining
//   moved away     messages moved into a conversation you can't read
// plus controls that must survive the same check: a public channel, a DM, a
// public channel you were removed from (still readable), and messages moved
// into a conversation you can read (re-filed by the delta, never dropped).
// Then the fast path: a `moved_out` line applied from a delta drops its ids
// with no check at all.

import { rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import type { SQL } from "bun";
import { stampMinus } from "./db";
import type { SyncIdsAnswer } from "./page/chat-store";
import type { ChatRow } from "./page/fixture";
import { micros } from "./page/fixture";

const W = crypto.randomUUID();
const ME = crypto.randomUUID();
const BOSS = crypto.randomUUID();
const OTHER = crypto.randomUUID();
const C = {
  general: crypto.randomUUID(),
  dm: crypto.randomUUID(),
  removed: crypto.randomUUID(),
  deleted: crypto.randomUUID(),
  madePrivate: crypto.randomUUID(),
  source: crypto.randomUUID(),
  target: crypto.randomUUID(),
  publicLeft: crypto.randomUUID(),
};
const HELD = [
  "general",
  "dm",
  "removed",
  "deleted",
  "madePrivate",
  "source",
  "publicLeft",
] as const;

type Json = Record<string, unknown>;

function toRow(j: Json): ChatRow {
  return {
    id: j.id as string,
    workspaceId: j.workspace_id as string,
    channelId: j.channel_id as string,
    parentId: (j.parent_id as string) ?? null,
    replyToId: (j.reply_to_id as string) ?? null,
    authorId: (j.author_id as string) ?? null,
    authorKind: j.author_kind as "user",
    authorLabel: (j.author_label as string) ?? null,
    apiKeyId: null,
    body: j.body as string,
    formatVersion: 2,
    kind: j.kind as "message" | "event",
    event: (j.event as ChatRow["event"]) ?? null,
    mentionedUserIds: j.mentioned_user_ids as string[],
    mentionedTeamIds: [],
    mentionsEveryone: false,
    reactions: j.reactions as Record<string, string[]>,
    replyCount: j.reply_count as number,
    lastReplyAt: (j.last_reply_at as string) ?? null,
    replyUserIds: j.reply_user_ids as string[],
    pinnedAt: (j.pinned_at as string) ?? null,
    pinnedBy: (j.pinned_by as string) ?? null,
    editedAt: (j.edited_at as string) ?? null,
    deletedAt: (j.deleted_at as string) ?? null,
    decisionAt: null,
    decisionBy: null,
    movedAt: (j.moved_at as string) ?? null,
    movedFromChannelId: (j.moved_from_channel_id as string) ?? null,
    createdAt: j.created_at as string,
    updatedAt: j.updated_at as string,
    at: micros(j.created_at as string),
  };
}

async function seed(sql: SQL): Promise<void> {
  await sql.unsafe(`insert into spike_s2.workspace_members values ($1, $2), ($1, $3), ($1, $4)`, [
    W,
    ME,
    BOSS,
    OTHER,
  ]);
  const channels: [string, string, boolean, string | null][] = [
    [C.general, "channel", false, "general"],
    [C.dm, "dm", true, null],
    [C.removed, "channel", true, "removed"],
    [C.deleted, "channel", false, "deleted"],
    [C.madePrivate, "channel", false, "made-private"],
    [C.source, "channel", true, "source"],
    [C.target, "channel", true, "target"],
    [C.publicLeft, "channel", false, "public-left"],
  ];
  for (const [id, kind, isPrivate, name] of channels) {
    await sql.unsafe(
      `insert into spike_s2.chat_channels (id, workspace_id, kind, name, is_private, dm_key, created_by)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, W, kind, name, isPrivate, kind === "dm" ? [ME, OTHER].sort().join(":") : null, BOSS],
    );
  }
  // ME is a member of everything held except made-private (read from Browse).
  const memberships: [string, string][] = [
    [C.general, ME],
    [C.dm, ME],
    [C.dm, OTHER],
    [C.removed, ME],
    [C.removed, BOSS],
    [C.deleted, ME],
    [C.deleted, BOSS],
    [C.source, ME],
    [C.source, BOSS],
    [C.target, BOSS],
    [C.publicLeft, ME],
  ];
  for (const [channel, user] of memberships) {
    await sql.unsafe(
      `insert into spike_s2.chat_members (channel_id, user_id, workspace_id) values ($1, $2, $3)`,
      [channel, user, W],
    );
  }
  for (const id of Object.values(C)) {
    await sql.unsafe(
      `insert into spike_s2.chat_messages (workspace_id, channel_id, author_id, body, created_at)
       select $1, $2, $3, 'message ' || g, now() - interval '2 days' + g * interval '1 minute'
         from generate_series(1, 40) g`,
      [W, id, BOSS],
    );
  }
}

async function readAs(sql: SQL, conv: string): Promise<ChatRow[]> {
  const rows: { j: Json }[] = await sql.unsafe(
    `select to_jsonb(m) as j from spike_s2.chat_messages_page($1, $2, null, null, 'before', 1500) m`,
    [conv, ME],
  );
  return rows.map((r) => toRow(r.j)).reverse();
}

async function syncIds(sql: SQL, since: string | null): Promise<SyncIdsAnswer & { ms: number }> {
  const t = performance.now();
  const rows: { kind: string; id: string; conversation_id: string; checked_at: string }[] =
    await sql.unsafe(
      `select kind, id::text as id, conversation_id::text as conversation_id,
              to_char(checked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00' as checked_at
         from spike_s2.chat_sync_ids($1, $2, $3::timestamptz)`,
      [W, ME, since],
    );
  const ms = performance.now() - t;
  const [{ at }] = await sql.unsafe(
    `select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00' as at`,
  );
  return {
    conversations: rows.filter((r) => r.kind === "conversation").map((r) => r.id),
    members: rows.filter((r) => r.kind === "member").map((r) => r.id),
    movedAway: rows
      .filter((r) => r.kind === "moved_away")
      .map((r) => ({ id: r.id, conversationId: r.conversation_id })),
    checkedAt: rows[0]?.checked_at ?? at,
    ms,
  };
}

/** chat_op_move_messages, as much as the store sees of it. */
async function move(sql: SQL, ids: string[], from: string, to: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(
      `update spike_s2.chat_messages
          set moved_from_channel_id = channel_id, channel_id = $2, moved_at = now(), moved_by = $3
        where id = any($1::uuid[])`,
      [`{${ids.join(",")}}`, to, BOSS],
    );
    for (const [conv, type, other] of [
      [from, "moved_out", to],
      [to, "moved_in", from],
    ] as const) {
      await tx.unsafe(
        `insert into spike_s2.chat_messages (workspace_id, channel_id, author_id, kind, event, body)
         values ($1, $2, $3, 'event', $4::text::jsonb, '')`,
        [
          W,
          conv,
          BOSS,
          JSON.stringify({
            type,
            ids,
            ...(type === "moved_out" ? { to: other } : { from: other }),
          }),
        ],
      );
    }
  });
}

async function cursorNow(sql: SQL): Promise<string> {
  const [{ at }] = await sql.unsafe(
    `select to_char(max(updated_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00' as at
       from spike_s2.chat_messages where workspace_id = $1`,
    [W],
  );
  return at;
}

async function delta(sql: SQL, since: string): Promise<ChatRow[]> {
  const rows: { j: Json }[] = await sql.unsafe(
    `select to_jsonb(m) as j from spike_s2.chat_messages_delta($1, $2, $3::timestamptz, null, 1000) m`,
    [W, ME, stampMinus(since, 5 * 60_000)],
  );
  return rows.map((r) => toRow(r.j));
}

export async function proveAccess(sql: SQL, outDir: string) {
  await seed(sql);
  const byConv: Record<string, ChatRow[]> = {};
  for (const name of HELD) byConv[C[name]] = await readAs(sql, C[name]);
  const movedAway = byConv[C.source].slice(5, 10).map((r) => r.id);
  const movedReadable = byConv[C.source].slice(20, 22).map((r) => r.id);
  const fastPath = byConv[C.source].slice(30, 33).map((r) => r.id);
  const name = Object.fromEntries(Object.entries(C).map(([k, v]) => [v, k]));
  const named = (s: { conversations: Record<string, unknown> }) =>
    Object.fromEntries(Object.entries(s.conversations).map(([id, v]) => [name[id], v]));

  const dir = join(outDir, "chromium-access");
  rmSync(dir, { recursive: true, force: true });
  const { buildPage } = await import("./browser-bench");
  const files = await buildPage();
  const ctx = await chromium.launchPersistentContext(dir, { channel: "chromium", headless: true });
  await ctx.route("http://spike.local/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: files[path] ? 200 : 404,
      contentType: path.endsWith(".js") ? "text/javascript" : "text/html",
      body: files[path] ?? "",
    });
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("http://spike.local/");
  const ids = Object.values(C);
  try {
    const before = await page.evaluate((o) => window.spike.accessSetup(o), {
      db: "spike-access",
      ws: W,
      person: ME,
      byConv,
    });
    // Check 0: nothing has changed; nothing may go.
    const check0 = await syncIds(sql, null);
    const r0 = await page.evaluate((a) => window.spike.accessReconcile(a), check0);
    const cursor0 = await cursorNow(sql);

    // Access changes, each as its op would write it. No event reaches the store.
    await sql.unsafe(
      `update spike_s2.chat_members set left_at = now(), removed_by = $3 where channel_id = $1 and user_id = $2`,
      [C.removed, ME, BOSS],
    );
    await sql.begin(async (tx) => {
      await tx.unsafe(
        `update spike_s2.chat_channels set deleted_at = now(), deleted_by = $2 where id = $1`,
        [C.deleted, BOSS],
      );
      // The op touches every member's row so the change reaches them live.
      await tx.unsafe(`update spike_s2.chat_members set left_at = left_at where channel_id = $1`, [
        C.deleted,
      ]);
    });
    await sql.unsafe(`update spike_s2.chat_channels set is_private = true where id = $1`, [
      C.madePrivate,
    ]);
    await move(sql, movedAway, C.source, C.target);
    // Controls: moved where ME reads; removed from a public channel (still readable).
    await move(sql, movedReadable, C.source, C.general);
    await sql.unsafe(
      `update spike_s2.chat_members set left_at = now(), removed_by = $3 where channel_id = $1 and user_id = $2`,
      [C.publicLeft, ME, BOSS],
    );

    // Check 1: one access check, since check 0 (minus the lookback).
    const check1 = await syncIds(sql, stampMinus(check0.checkedAt, 5 * 60_000));
    const r1 = await page.evaluate((a) => window.spike.accessReconcile(a), check1);
    const after = await page.evaluate(({ ws, convs }) => window.spike.accessState(ws, convs), {
      ws: W,
      convs: ids,
    });
    const movedState = await page.evaluate(
      (x) => window.spike.accessHas(x),
      [...movedAway, ...movedReadable],
    );

    // The delta after the check re-files what moved where ME reads.
    const d1 = await delta(sql, cursor0);
    const applied1 = await page.evaluate((rows) => window.spike.accessApply(rows), d1);
    const refiled = await page.evaluate(({ ws, convs }) => window.spike.accessState(ws, convs), {
      ws: W,
      convs: [C.general, C.source],
    });

    // The fast path: a move with no access check at all, only the delta.
    const cursor1 = await cursorNow(sql);
    await move(sql, fastPath, C.source, C.target);
    const d2 = await delta(sql, cursor1);
    const applied2 = await page.evaluate((rows) => window.spike.accessApply(rows), d2);
    const fastState = await page.evaluate((x) => window.spike.accessHas(x), fastPath);

    const gone = (n: string) => {
      const s = (
        after.conversations as Record<string, { memory: number; device: number; inMeta: boolean }>
      )[C[n as keyof typeof C]];
      return s.memory === 0 && s.device === 0 && !s.inMeta;
    };
    const kept = (n: string) => {
      const s = (after.conversations as Record<string, { memory: number; device: number }>)[
        C[n as keyof typeof C]
      ];
      return s.memory > 0 && s.device > 0;
    };
    const movedGone = movedAway.every((id) => !movedState[id].memory && !movedState[id].device);
    const readableMovedKept = movedReadable.every(
      (id) => movedState[id].memory && movedState[id].device,
    );
    const fastGone = fastPath.every((id) => !fastState[id].memory && !fastState[id].device);
    const cases = {
      removed: gone("removed"),
      deleted: gone("deleted"),
      madePrivate: gone("madePrivate"),
      movedAway: movedGone && kept("source"),
      controls: {
        general: kept("general"),
        dm: kept("dm"),
        publicLeftStillReadable: kept("publicLeft"),
        movedIntoReadableKept: readableMovedKept,
        check0DroppedNothing: r0.droppedConversations.length === 0 && r0.droppedIds.length === 0,
        membersAfter: check1.members.map((m) => name[m]),
      },
      fastPath: fastGone,
    };
    return {
      before: named(before),
      check0: {
        droppedConversations: r0.droppedConversations.length,
        droppedIds: r0.droppedIds.length,
        sqlMs: check0.ms,
      },
      check1: {
        readable: check1.conversations.map((c) => name[c]),
        movedAway: check1.movedAway.length,
        sqlMs: check1.ms,
        droppedConversations: r1.droppedConversations.map((c) => name[c]),
        droppedIds: r1.droppedIds.length,
        reconcileMs: r1.ms,
      },
      after: named(after),
      refiled: named(refiled),
      deltaAfterCheck: applied1,
      fastPath: { ...applied2, droppedIds: applied2.dropped.length },
      cases,
      pass:
        cases.removed &&
        cases.deleted &&
        cases.madePrivate &&
        cases.movedAway &&
        cases.fastPath &&
        Object.values(cases.controls).every((v) => v !== false),
    };
  } finally {
    await ctx.close();
  }
}
