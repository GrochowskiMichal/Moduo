#!/usr/bin/env bun
// The 10,000-message fixture (Chat v2 CV-7a, spec §Assumptions #22) on the
// LOCAL stack only: a Duo workspace of its own ("Chat perf 10k") owned by
// chat-perf@moduo.local, with a second member, whose General holds 10,000
// messages over about ten months, shaped like spike 1's harness: half
// one-liners, a fifth paragraphs, some long multi-paragraph notes, code
// blocks, lists, links and Polish text, by four authors in runs.
//
// Idempotent: a General that already holds the fixture's count is left alone.
// `--force` makes the workspace again. Rows go in through PostgREST as the
// service role (the send op limits how fast one person sends); triggers run
// as for real rows.
//
//   bun scripts/perf/seed-chat-10k.ts            seed (or keep) the fixture
//   bun scripts/perf/seed-chat-10k.ts --force    seed it again

import {
  type ChatRoom,
  ensureChatPerson,
  makeChatRoom,
  seedHistory,
} from "../../tests/support/chat-room";
import { rest, stackKeys } from "../../tests/support/local-stack";

export const CHAT_PERF_OWNER = {
  email: "chat-perf@moduo.local",
  password: "localchatperf-10k",
  name: "Perf Owner",
};
export const CHAT_PERF_MEMBER = {
  email: "chat-perf-member@moduo.local",
  password: "localchatperf-member",
  name: "Perf Member",
};
export const CHAT_PERF_WORKSPACE = "Chat perf 10k";
export const CHAT_PERF_MESSAGES = 10_000;

const ONE_LINERS = [
  "Pushed the fix, can you check?",
  "Looks good to me 👍",
  "On it.",
  "Can we move the review to Thursday?",
  "Zrobione, dzięki!",
  "Shipping after lunch.",
  "The build is green again.",
  "Who's taking the release notes?",
];
const PARAGRAPH =
  "I went through the onboarding flow again with fresh eyes and the second step still asks for too much at once: the workspace name, the plan and the invite all compete for attention. Splitting it would cost us one more screen but the drop-off data says it's worth it.";
const LONG = `${PARAGRAPH}\n\n${PARAGRAPH}\n\nZażółć gęślą jaźń: the Polish copy wraps differently, so check the narrow window too.\n\n${PARAGRAPH}`;
const CODE =
  "Here's the query:\n\n```sql\nselect id, created_at\nfrom chat_messages\nwhere channel_id = $1\norder by created_at desc, id desc\nlimit 51;\n```";
const LIST = "Plan for today:\n\n- finish the stream\n- review the composer\n- write the record";
const LINK = "The deck is at https://example.com/deck and the notes are **in the doc**.";

/** The body of the fixture's message `i` (deterministic). */
export function fixtureBody(i: number): string {
  const r = (i * 2654435761) % 100;
  if (r < 50) return `${ONE_LINERS[i % ONE_LINERS.length]} (${i})`;
  if (r < 70) return `${PARAGRAPH} (${i})`;
  if (r < 78) return `${LONG} (${i})`;
  if (r < 85) return `${CODE}\n\n(${i})`;
  if (r < 93) return `${LIST} (${i})`;
  return `${LINK} (${i})`;
}

async function existing(): Promise<ChatRoom | null> {
  const owner = await ensureChatPerson(CHAT_PERF_OWNER);
  const member = await ensureChatPerson(CHAT_PERF_MEMBER);
  const [ws] = await rest<Array<{ id: string }>>(
    "service",
    `workspaces?owner_id=eq.${owner.user.id}&name=eq.${encodeURIComponent(CHAT_PERF_WORKSPACE)}&deleted_at=is.null&select=id`,
  );
  if (!ws) return null;
  const [general] = await rest<Array<{ id: string }>>(
    "service",
    `chat_channels?workspace_id=eq.${ws.id}&is_default=is.true&select=id`,
  );
  if (!general) return null;
  return { owner, member, ws: ws.id, general: general.id };
}

async function count(room: ChatRoom): Promise<number> {
  const { url, service } = stackKeys();
  const res = await fetch(
    `${url}/rest/v1/chat_messages?channel_id=eq.${room.general}&deleted_at=is.null&select=id`,
    {
      method: "HEAD",
      headers: { apikey: service, Authorization: `Bearer ${service}`, Prefer: "count=exact" },
    },
  );
  return Number(res.headers.get("content-range")?.split("/")[1] ?? 0);
}

/** The fixture's room, seeded if it isn't there yet. */
export async function seedChatPerfFixture(force = false): Promise<ChatRoom> {
  const { url } = stackKeys();
  if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
    throw new Error("The chat perf fixture is for the local stack only.");
  }
  const held = force ? null : await existing();
  if (held && (await count(held)) >= CHAT_PERF_MESSAGES) return held;
  const room = await makeChatRoom(CHAT_PERF_OWNER, CHAT_PERF_MEMBER, CHAT_PERF_WORKSPACE);
  const authors = [room.owner, room.member];
  const rows = Array.from({ length: CHAT_PERF_MESSAGES }, (_, i) => ({
    // Runs of one to four messages by one person.
    author: authors[Math.floor(i / (1 + (i % 4))) % 2]!,
    body: fixtureBody(i),
    // About ten months, newest last.
    minutesAgo: (CHAT_PERF_MESSAGES - i) * 43 + 5,
  }));
  await seedHistory(room, rows);
  return room;
}

if (import.meta.main) {
  const room = await seedChatPerfFixture(process.argv.includes("--force"));
  console.log(`chat perf fixture: workspace ${room.ws}, General ${room.general}`);
}
