import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { AtThreeDensities } from "@/components/ui/kit-densities";

import type { ChatMessage, ChatPerson } from "../model";
import type { ChatWindow } from "../store/store";
import { MessageStream } from "./message-stream";
import { DaySeparator, EventLine, MessageRow, NewPill } from "./rows";

// The stream (CV-7a, round 5 frames 5–6) at the three densities: 15 px text
// everywhere, names by weight, 24 / 20 / 16 px before a new person and 6 px
// between one person's lines, one left edge, centred separators, the "New"
// pill, the sending states and an event line. `tests/visual/chat-stream.spec.ts`
// reads these.

const people: Record<string, ChatPerson> = {
  so: { userId: "so", name: "Sofia Ortiz", avatarUrl: null, role: "member", former: false },
  mc: { userId: "mc", name: "Mike Chen", avatarUrl: null, role: "member", former: false },
  me: { userId: "me", name: "Alex Rivera", avatarUrl: null, role: "owner", former: false },
};
const personOf = (id: string) => people[id];

const BASE = Date.parse("2026-10-15T09:40:00Z");
let seq = 0;
function msg(author: string, body: string, minutes: number, extra: Partial<ChatMessage> = {}) {
  seq += 1;
  const at = new Date(BASE + minutes * 60_000).toISOString();
  const m: ChatMessage = {
    id: `m${seq}`,
    workspaceId: "w",
    channelId: "c",
    parentId: null,
    replyToId: null,
    kind: "message",
    event: null,
    formatVersion: 2,
    authorId: author,
    authorKind: "user",
    authorLabel: null,
    body,
    mentionedUserIds: [],
    mentionedTeamIds: [],
    mentionsEveryone: false,
    reactions: {},
    replyCount: 0,
    lastReplyAt: null,
    replyUserIds: [],
    wrappedAt: null,
    wrappedBy: null,
    settledId: null,
    reopenedAt: null,
    reopenedBy: null,
    pinnedAt: null,
    pinnedBy: null,
    decisionAt: null,
    decisionBy: null,
    editedAt: null,
    deletedAt: null,
    clientId: null,
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
  return m;
}

const ROWS: ChatMessage[] = [
  msg("so", "Morning! Pushed the new hero to staging.", 0),
  msg("so", "Copy is next, this one's mine. Same logo lockup as the deck.", 1, {
    reactions: { "👍": ["mc", "me"], "✅": ["me"] },
  }),
  msg("mc", "Nav looks great on narrow windows too. The logo spacing is **fixed**.", 25, {
    replyCount: 2,
    lastReplyAt: new Date(BASE + 40 * 60_000).toISOString(),
  }),
  msg("me", "🎉", 26),
  msg("so", "Can you check `bun run build` on CI?\n\n- one\n- two", 50, {
    editedAt: new Date(BASE + 52 * 60_000).toISOString(),
  }),
  msg("me", "On it, sending the notes in a minute.", 51, { sendState: "waiting" }),
  msg("me", "And the link to the deck", 52, {
    sendState: "failed",
    sendError: "This conversation is read only for you.",
  }),
];

const ctx = { selfId: "me", personOf };
const noop = () => {};

function Rows() {
  return (
    <div className="w-160 bg-card py-2">
      <DaySeparator at={ROWS[0]!.createdAt} />
      {ROWS.slice(0, 2).map((m, i) => (
        <MessageRow
          key={m.id}
          message={m}
          first={i === 0}
          person={personOf(m.authorId ?? "")}
          ctx={ctx}
          handlers={{}}
        />
      ))}
      <NewPill />
      {ROWS.slice(2).map((m, i) => (
        <MessageRow
          key={m.id}
          message={m}
          first={i !== 3 && i !== 4}
          person={personOf(m.authorId ?? "")}
          ctx={ctx}
          handlers={{}}
        />
      ))}
      <EventLine message={msg("so", "", 60, { kind: "event", event: { type: "moved_out" } })} />
    </div>
  );
}

const meta: Meta = {
  title: "Features/Chat/Stream",
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj;

/** The message row north star at three densities (AC14.1). */
export const Densities: Story = {
  render: () => <AtThreeDensities direction="column">{() => <Rows />}</AtThreeDensities>,
};

function StreamDemo() {
  const [hidden] = useState<ReadonlySet<string>>(() => new Set());
  const win: ChatWindow = {
    rows: ROWS,
    hasOlder: false,
    hasNewer: false,
    loading: false,
    loaded: true,
    newAfter: { at: ROWS[1]!.createdAt, id: ROWS[1]!.id },
    target: null,
  };
  return (
    <div className="flex h-120 w-160 flex-col bg-card">
      <MessageStream
        conversationId="story"
        window={win}
        selfId="me"
        personOf={personOf}
        rowById={() => undefined}
        hidden={hidden}
        editingId={null}
        canWrite
        onLoadOlder={noop}
        onLoadNewer={noop}
        onJumpToLatest={noop}
        onSeen={noop}
        onStartEdit={noop}
        renderEditor={() => null}
        onDelete={noop}
        onReact={noop}
        onPin={noop}
        onTask={noop}
        onCopyLink={noop}
        onMarkUnread={noop}
        onOpenChain={noop}
        onReply={noop}
        onRetry={noop}
        onDiscard={noop}
        onReturnToComposer={noop}
      />
    </div>
  );
}

/** The virtualized stream: opens at the bottom, fades at both ends, the hover toolbar. */
export const Stream: Story = {
  render: () => <StreamDemo />,
};
