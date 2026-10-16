// CV-0 spike 2, pass bar 3, in SQL on the local stack (scratch schema spike_s2):
//   a. after 1,000 missed changes (sends, edits, reactions, deletes, pins,
//      reply rollups, moves), a delta read by `updated_at` equals a full read;
//      a transaction that commits late is caught by the 5-minute lookback and
//      missed without it (the negative control);
//   b. keyset pages over a conversation whose 200 messages share one
//      created_at return each message exactly once, in both directions, for
//      the row-comparison form and PostgREST's `or=` form.

import type { SQL } from "bun";
import { CREATED, STAMP, stampMinus } from "./db";

const W = crypto.randomUUID();
const U1 = crypto.randomUUID(); // the reader whose device copy we follow
const U2 = crypto.randomUUID();
const U3 = crypto.randomUUID();
const MAIN = crypto.randomUUID(); // public, 10,000 messages
const OTHER = crypto.randomUUID(); // public
const PRIV = crypto.randomUUID(); // private, U1 a member
const HIDDEN = crypto.randomUUID(); // private, U1 not a member: never in U1's reads
const LOOKBACK_MS = 5 * 60_000;

type Copy = Map<string, { stamp: string; hash: string }>;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function seed(sql: SQL): Promise<{ tieAt: string }> {
  await sql.unsafe(`insert into spike_s2.workspace_members values ($1, $2), ($1, $3), ($1, $4)`, [
    W,
    U1,
    U2,
    U3,
  ]);
  await sql.unsafe(
    `insert into spike_s2.chat_channels (id, workspace_id, kind, name, is_private, created_by) values
       ($1, $5, 'channel', 'main', false, $6),
       ($2, $5, 'channel', 'other', false, $6),
       ($3, $5, 'channel', 'priv', true, $6),
       ($4, $5, 'channel', 'hidden', true, $7)`,
    [MAIN, OTHER, PRIV, HIDDEN, W, U1, U2],
  );
  await sql.unsafe(
    `insert into spike_s2.chat_members (channel_id, user_id, workspace_id) values
       ($1, $3, $4), ($2, $3, $4), ($5, $6, $4)`,
    [MAIN, PRIV, U1, W, HIDDEN, U2],
  );
  // 10,000 in MAIN over 30 days; rows 5,000–5,199 share one created_at
  // exactly (what one transaction, a bulk move or the v1 conversion writes).
  const [{ tie }] = await sql.unsafe(
    `select to_char((now() - interval '15 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00' as tie`,
  );
  await sql.unsafe(
    `insert into spike_s2.chat_messages (workspace_id, channel_id, author_id, body, reactions, created_at)
     select $1, $2, (array[$3, $4, $5]::uuid[])[1 + g % 3],
            left(repeat(md5(g::text) || ' ', 1 + (g * 7919) % 40), 7999),
            case when g % 11 = 0 then jsonb_build_object('👍', jsonb_build_array($4)) else '{}'::jsonb end,
            case when g between 5000 and 5199 then $6::timestamptz
                 else now() - interval '30 days' + g * interval '259 seconds' end
       from generate_series(1, 10000) g`,
    [W, MAIN, U1, U2, U3, tie],
  );
  for (const [channel, n] of [
    [OTHER, 500],
    [PRIV, 300],
    [HIDDEN, 300],
  ] as const) {
    await sql.unsafe(
      `insert into spike_s2.chat_messages (workspace_id, channel_id, author_id, body, created_at)
       select $1, $2, $3, 'msg ' || g, now() - interval '20 days' + g * interval '3 minutes'
         from generate_series(1, $4::int) g`,
      [W, channel, U2, n],
    );
  }
  // A seeded row was last changed when it was sent (updated_at = created_at,
  // spread over 30 days): otherwise every row falls inside the delta's
  // 5-minute lookback and a "delta" is just another full read. The trigger is
  // off for this (it would re-stamp), as a backfill that isn't an edit does it
  // (gotchas §Supabase).
  await sql.unsafe(`alter table spike_s2.chat_messages disable trigger zz_stamp_updated_at`);
  await sql.unsafe(`update spike_s2.chat_messages set updated_at = created_at`);
  await sql.unsafe(`alter table spike_s2.chat_messages enable trigger zz_stamp_updated_at`);
  await sql.unsafe(`analyze spike_s2.chat_messages`);
  return { tieAt: tie };
}

/** Everything U1 can read now, as (id → stamp, hash). */
async function fullRead(sql: SQL): Promise<Copy> {
  const rows = await sql.unsafe(
    `select m.id::text as id, ${STAMP} as stamp, md5(to_jsonb(m)::text) as hash
       from spike_s2.chat_messages m
      where m.workspace_id = $1 and spike_s2.chat_can_read(m.channel_id, $2)`,
    [W, U1],
  );
  return new Map(rows.map((r: { id: string; stamp: string; hash: string }) => [r.id, r]));
}

type DeltaResult = {
  rows: number;
  pages: number;
  cursor: string;
  ids: Set<string>;
  repeatsSameStamp: number;
  repeatsNewStamp: number;
  ms: number;
};

/**
 * The store's delta read: from `since`, pages of `pageSize` by (updated_at,
 * id), each row kept if its stamp is at least the copy's. `between` runs
 * after each page (concurrent writers).
 */
async function deltaRead(
  sql: SQL,
  copy: Copy,
  since: string,
  pageSize: number,
  between?: (page: number, read: string[]) => Promise<void>,
): Promise<DeltaResult> {
  const started = performance.now();
  let afterStamp = since;
  let afterId: string | null = null;
  let cursor = since;
  let pages = 0;
  let rows = 0;
  let repeatsSameStamp = 0;
  let repeatsNewStamp = 0;
  const seen = new Map<string, string>();
  for (;;) {
    const page: { id: string; stamp: string; hash: string }[] = await sql.unsafe(
      `select m.id::text as id, ${STAMP} as stamp, md5(to_jsonb(m)::text) as hash
         from spike_s2.chat_messages_delta($1, $2, $3::timestamptz, $4::uuid, $5) m`,
      [W, U1, afterStamp, afterId, pageSize],
    );
    pages += 1;
    for (const r of page) {
      rows += 1;
      const before = seen.get(r.id);
      if (before === r.stamp) repeatsSameStamp += 1;
      else if (before) repeatsNewStamp += 1;
      seen.set(r.id, r.stamp);
      const held = copy.get(r.id);
      if (!held || r.stamp >= held.stamp) copy.set(r.id, { stamp: r.stamp, hash: r.hash });
      if (r.stamp > cursor) cursor = r.stamp;
    }
    if (page.length < pageSize) break;
    afterStamp = page[page.length - 1].stamp;
    afterId = page[page.length - 1].id;
    if (between) await between(pages, [...seen.keys()]);
  }
  return {
    rows,
    pages,
    cursor,
    ids: new Set(seen.keys()),
    repeatsSameStamp,
    repeatsNewStamp,
    ms: Math.round(performance.now() - started),
  };
}

function compare(copy: Copy, full: Copy): { missing: string[]; extra: string[]; stale: string[] } {
  const missing: string[] = [];
  const stale: string[] = [];
  for (const [id, r] of full) {
    const held = copy.get(id);
    if (!held) missing.push(id);
    else if (held.hash !== r.hash) stale.push(id);
  }
  const extra = [...copy.keys()].filter((id) => !full.has(id));
  return { missing, extra, stale };
}

async function readableIds(sql: SQL, channels: string[]): Promise<string[]> {
  const rows = await sql.unsafe(
    `select id::text as id from spike_s2.chat_messages where channel_id = any($1::uuid[]) and parent_id is null and deleted_at is null`,
    [`{${channels.join(",")}}`],
  );
  return rows.map((r: { id: string }) => r.id);
}

/** 1,000 changes in 100 transactions of 10, every kind the delta must see. */
async function thousandChanges(sql: SQL): Promise<Record<string, number>> {
  const r = rng(42);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const visible = await readableIds(sql, [MAIN, OTHER, PRIV]);
  const hidden = await readableIds(sql, [HIDDEN]);
  const plan: string[] = [
    ...Array(250).fill("send"),
    ...Array(200).fill("edit"),
    ...Array(200).fill("react"),
    ...Array(150).fill("delete"),
    ...Array(100).fill("reply"),
    ...Array(50).fill("pin"),
    ...Array(50).fill("move"),
  ];
  for (let i = plan.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [plan[i], plan[j]] = [plan[j], plan[i]];
  }
  const counts: Record<string, number> = {};
  for (let t = 0; t < 100; t += 1) {
    await sql.begin(async (tx) => {
      for (const kind of plan.slice(t * 10, t * 10 + 10)) {
        counts[kind] = (counts[kind] ?? 0) + 1;
        // One change in ten lands where U1 can't read: it must not show up.
        const target = r() < 0.1 ? pick(hidden) : pick(visible);
        switch (kind) {
          case "send": {
            const channel = r() < 0.1 ? HIDDEN : pick([MAIN, MAIN, OTHER, PRIV]);
            await tx.unsafe(
              `insert into spike_s2.chat_messages (id, workspace_id, channel_id, author_id, body)
               values ($1, $2, $3, $4, $5)`,
              [crypto.randomUUID(), W, channel, U2, `new ${t}`],
            );
            break;
          }
          case "edit":
            await tx.unsafe(
              `update spike_s2.chat_messages set body = body || ' (edited)', edited_at = now() where id = $1`,
              [target],
            );
            break;
          case "react":
            await tx.unsafe(
              `update spike_s2.chat_messages
                  set reactions = jsonb_set(reactions, '{🎉}', coalesce(reactions -> '🎉', '[]'::jsonb) || to_jsonb($2::text))
                where id = $1`,
              [target, U3],
            );
            break;
          case "delete":
            await tx.unsafe(
              `update spike_s2.chat_messages
                  set deleted_at = now(), body = '', reactions = '{}', mentioned_user_ids = '{}'
                where id = $1`,
              [target],
            );
            break;
          case "reply": {
            const [root] = await tx.unsafe(
              `select channel_id::text as channel from spike_s2.chat_messages where id = $1`,
              [target],
            );
            await tx.unsafe(
              `insert into spike_s2.chat_messages (workspace_id, channel_id, parent_id, reply_to_id, author_id, body)
               values ($1, $2, $3, $3, $4, 'a reply')`,
              [W, root.channel, target, U3],
            );
            await tx.unsafe(
              `update spike_s2.chat_messages
                  set reply_count = reply_count + 1, last_reply_at = now(),
                      reply_user_ids = array(select distinct unnest(reply_user_ids || $2::uuid))
                where id = $1`,
              [target, U3],
            );
            break;
          }
          case "pin":
            await tx.unsafe(
              `update spike_s2.chat_messages set pinned_at = now(), pinned_by = $2 where id = $1`,
              [target, U2],
            );
            break;
          case "move":
            // Between two conversations U1 reads: the row is re-filed by the delta.
            await tx.unsafe(
              `update spike_s2.chat_messages
                  set moved_from_channel_id = channel_id,
                      channel_id = case when channel_id = $2 then $3 else $2 end,
                      moved_at = now(), moved_by = $4
                where id = $1 and channel_id in ($2, $3)`,
              [target, MAIN, OTHER, U2],
            );
            break;
        }
      }
    });
  }
  return counts;
}

export type DeltaProof = Awaited<ReturnType<typeof proveDelta>>;

export async function proveDelta(sql: SQL) {
  const { tieAt } = await seed(sql);
  // The device copy as of the last sync: everything U1 could read, and its cursor.
  const copy = await fullRead(sql);
  const c0 = [...copy.values()].reduce((a, r) => (r.stamp > a ? r.stamp : a), "");
  // A transaction that writes early and commits late (stamp T1 < later commits).
  const late = await sql.reserve();
  const [x] = await sql.unsafe(
    `select id::text as id from spike_s2.chat_messages where channel_id = $1 order by created_at limit 1 offset 17`,
    [MAIN],
  );
  await late.unsafe("begin");
  await late.unsafe(
    `update spike_s2.chat_messages set body = 'committed late', edited_at = now() where id = $1`,
    [x.id],
  );
  const counts = await thousandChanges(sql);
  // Delta #1, paged by 100, while someone keeps editing rows (some already read).
  // Each round edits two rows this read already took (they move past the
  // read's position and must come again) and one it hasn't reached.
  const r = rng(7);
  const midIds = await readableIds(sql, [MAIN, OTHER]);
  let midEdits = 0;
  const d1 = await deltaRead(sql, copy, stampMinus(c0, LOOKBACK_MS), 100, async (page, read) => {
    if (page > 9) return; // writers stop before the read's last pages
    const targets = [
      read[Math.floor(r() * read.length)],
      read[Math.floor(r() * read.length)],
      midIds[Math.floor(r() * midIds.length)],
    ];
    for (const id of targets) {
      midEdits += 1;
      await sql.unsafe(`update spike_s2.chat_messages set body = body || ' ·' where id = $1`, [id]);
    }
  });
  const lateHashAfterD1 = copy.get(x.id)?.hash ?? null;
  await late.unsafe("commit");
  late.release();
  // Delta #2 without a lookback (the trap): the late row's stamp is older than the cursor.
  const noLookback: Copy = new Map(copy);
  const d2bad = await deltaRead(sql, noLookback, d1.cursor, 100);
  // Delta #2 as the store does it: cursor minus 5 minutes.
  const d2 = await deltaRead(sql, copy, stampMinus(d1.cursor, LOOKBACK_MS), 100);
  const full = await fullRead(sql);
  const good = compare(copy, full);
  const bad = compare(noLookback, full);
  const hiddenLeaked = await sql.unsafe(
    `select count(*)::int as n from spike_s2.chat_messages where channel_id = $1 and id = any($2::uuid[])`,
    [HIDDEN, `{${[...copy.keys()].join(",")}}`],
  );
  // The delta's plan at the cursor, as the function spells it (row
  // comparison) and as PostgREST would (a >= bound plus the or= keyset).
  const plans: Record<string, string> = {};
  for (const form of ["row", "or"] as const) {
    const where =
      form === "row"
        ? `(m.updated_at, m.id) > ($2::timestamptz, $3::uuid)`
        : `m.updated_at >= $2::timestamptz and (m.updated_at > $2::timestamptz or (m.updated_at = $2::timestamptz and m.id > $3::uuid))`;
    const plan: { "QUERY PLAN": string }[] = await sql.unsafe(
      `explain (analyze, costs off, timing on, summary on)
       select m.* from spike_s2.chat_messages m
        where m.workspace_id = $1 and ${where}
        order by m.updated_at, m.id limit 100`,
      [W, stampMinus(d1.cursor, LOOKBACK_MS), "00000000-0000-0000-0000-000000000000"],
    );
    plans[form] = plan.map((p) => p["QUERY PLAN"]).join("\n");
  }
  return {
    tieAt,
    plans,
    changes: counts,
    midReadEdits: midEdits,
    delta1: {
      rows: d1.rows,
      pages: d1.pages,
      ms: d1.ms,
      repeatsSameStamp: d1.repeatsSameStamp,
      repeatsNewStamp: d1.repeatsNewStamp,
    },
    lateRow: {
      newVersionInDelta1: lateHashAfterD1 === full.get(x.id)?.hash,
      caughtWithLookback: d2.ids.has(x.id),
      caughtWithoutLookback: d2bad.ids.has(x.id),
    },
    delta2Rows: d2.rows,
    withLookback: {
      missing: good.missing.length,
      extra: good.extra.length,
      stale: good.stale.length,
    },
    withoutLookback: {
      missing: bad.missing.length,
      extra: bad.extra.length,
      stale: bad.stale.length,
      staleIsTheLateRow: bad.stale.length === 1 && bad.stale[0] === x.id,
    },
    hiddenRowsInCopy: hiddenLeaked[0].n,
    fullRows: full.size,
    pass:
      good.missing.length === 0 &&
      good.extra.length === 0 &&
      good.stale.length === 0 &&
      d1.repeatsSameStamp === 0 &&
      d1.repeatsNewStamp > 0 &&
      lateHashAfterD1 !== full.get(x.id)?.hash &&
      d2.ids.has(x.id) &&
      !d2bad.ids.has(x.id) &&
      hiddenLeaked[0].n === 0,
  };
}

type Key = { created: string; id: string };

async function pageAll(
  sql: SQL,
  channel: string,
  direction: "before" | "after",
  size: number,
  form: "row" | "or",
  from: Key | null = null,
  stopAt?: (k: Key) => boolean,
): Promise<{ keys: Key[]; pages: number; ms: number }> {
  const started = performance.now();
  const keys: Key[] = [];
  let at = from;
  let pages = 0;
  for (;;) {
    let page: Key[];
    if (form === "row") {
      page = await sql.unsafe(
        `select m.id::text as id, ${CREATED} as created
           from spike_s2.chat_messages_page($1, $2, $3::timestamptz, $4::uuid, $5, $6) m`,
        [channel, U1, at?.created ?? null, at?.id ?? null, direction, size],
      );
    } else {
      // PostgREST's spelling: or=(created_at.lt."T",and(created_at.eq."T",id.lt.X))
      const lt = direction === "before" ? "<" : ">";
      const order = direction === "before" ? "desc" : "asc";
      page = await sql.unsafe(
        `select m.id::text as id, ${CREATED} as created
           from spike_s2.chat_messages m
          where m.channel_id = $1
            and ($2::timestamptz is null
                 or m.created_at ${lt} $2::timestamptz
                 or (m.created_at = $2::timestamptz and m.id ${lt} $3::uuid))
          order by m.created_at ${order}, m.id ${order}
          limit $4`,
        [channel, at?.created ?? null, at?.id ?? null, size],
      );
    }
    pages += 1;
    for (const k of page) {
      if (stopAt?.(k)) return { keys, pages, ms: Math.round(performance.now() - started) };
      keys.push(k);
    }
    if (page.length < size) break;
    at = page[page.length - 1];
  }
  return { keys, pages, ms: Math.round(performance.now() - started) };
}

function checkOrder(keys: Key[], direction: "before" | "after"): boolean {
  for (let i = 1; i < keys.length; i += 1) {
    const a = keys[i - 1];
    const b = keys[i];
    const cmp = a.created === b.created ? (a.id < b.id ? -1 : 1) : a.created < b.created ? -1 : 1;
    if (direction === "before" ? cmp <= 0 : cmp >= 0) return false;
  }
  return true;
}

export async function proveKeyset(sql: SQL) {
  const { tieAt } = await seed(sql);
  const [{ n }] = await sql.unsafe(
    `select count(*)::int as n from spike_s2.chat_messages where channel_id = $1`,
    [MAIN],
  );
  const ties: { id: string }[] = await sql.unsafe(
    `select id::text as id from spike_s2.chat_messages where channel_id = $1 and created_at = $2::timestamptz`,
    [MAIN, tieAt],
  );
  const tieIds = new Set(ties.map((t) => t.id));
  const runs: Record<string, unknown>[] = [];
  let pass = tieIds.size === 200;
  for (const form of ["row", "or"] as const) {
    for (const direction of ["before", "after"] as const) {
      for (const size of [50, 33, 7]) {
        const { keys, pages, ms } = await pageAll(sql, MAIN, direction, size, form);
        const ids = keys.map((k) => k.id);
        const unique = new Set(ids);
        const tieSeen = ids.filter((id) => tieIds.has(id));
        const ok =
          ids.length === n &&
          unique.size === n &&
          tieSeen.length === 200 &&
          new Set(tieSeen).size === 200 &&
          checkOrder(keys, direction);
        pass &&= ok;
        runs.push({
          form,
          direction,
          size,
          rows: ids.length,
          unique: unique.size,
          ties: tieSeen.length,
          pages,
          ms,
          ok,
        });
      }
    }
  }
  // Pages that start at the tie group's edges and inside it, in both
  // directions, stopping once the read leaves the group.
  const [newer] = await sql.unsafe(
    `select m.id::text as id, ${CREATED} as created from spike_s2.chat_messages m
      where channel_id = $1 and created_at > $2::timestamptz order by created_at, id limit 1`,
    [MAIN, tieAt],
  );
  const [older] = await sql.unsafe(
    `select m.id::text as id, ${CREATED} as created from spike_s2.chat_messages m
      where channel_id = $1 and created_at < $2::timestamptz order by created_at desc, id desc limit 1`,
    [MAIN, tieAt],
  );
  const sortedTies = [...tieIds].sort();
  const inside: Key = { created: tieAt, id: sortedTies[117] };
  const starts: { name: string; direction: "before" | "after"; from: Key; expected: string[] }[] = [
    { name: "just newer, going back", direction: "before", from: newer, expected: sortedTies },
    { name: "just older, going forward", direction: "after", from: older, expected: sortedTies },
    {
      name: "inside the group, going back",
      direction: "before",
      from: inside,
      expected: sortedTies.slice(0, 117),
    },
    {
      name: "inside the group, going forward",
      direction: "after",
      from: inside,
      expected: sortedTies.slice(118),
    },
  ];
  const within: Record<string, unknown>[] = [];
  for (const s of starts) {
    const { keys } = await pageAll(sql, MAIN, s.direction, 50, "row", s.from, (k) =>
      leftGroup(k, tieAt, s.direction),
    );
    const got = keys.map((k) => k.id);
    const ok = got.length === s.expected.length && got.every((id) => s.expected.includes(id));
    pass &&= ok && new Set(got).size === got.length;
    within.push({ start: s.name, tieRows: got.length, expected: s.expected.length, ok });
  }
  const plans: Record<string, string> = {};
  for (const form of ["row", "or"] as const) {
    const where =
      form === "row"
        ? `(m.created_at, m.id) < ($2::timestamptz, $3::uuid)`
        : `(m.created_at < $2::timestamptz or (m.created_at = $2::timestamptz and m.id < $3::uuid))`;
    const plan: { "QUERY PLAN": string }[] = await sql.unsafe(
      `explain (analyze, costs off, timing on, summary on)
       select m.* from spike_s2.chat_messages m
        where m.channel_id = $1 and ${where}
        order by m.created_at desc, m.id desc limit 50`,
      [MAIN, tieAt, inside.id],
    );
    plans[form] = plan.map((p) => p["QUERY PLAN"]).join("\n");
  }
  return { channelRows: n, tieRows: tieIds.size, runs, within, plans, pass };
}

/** The read has left the tie group. */
function leftGroup(k: Key, tieAt: string, direction: "before" | "after"): boolean {
  return direction === "before" ? k.created < tieAt : k.created > tieAt;
}
