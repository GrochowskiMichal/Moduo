// Home's Catch up widget (CV-22, CH35, prototype round 5 frame 8): what's
// waiting for you, newest first, in the Catch up list's own words. Pure: the
// widget component passes what the chat store and the Catch up read hold.

import type { ChatCatchupItem, ChatChannel, ChatMessage, ChatPerson, ChatUnread } from "../model";
import { authorName } from "../stream/rows";
import { buildCatchup } from "./model";

export type CatchupWidgetRow = {
  id: string;
  /** The person the line is about, drawn bold (null: a sentence on its own). */
  who: string | null;
  /** Their user id, for the avatar. */
  whoId: string | null;
  /** "mentioned you · Acme rebrand", "direct message"… */
  line: string;
  at: string;
  quiet: boolean;
};

export type CatchupWidgetView = {
  rows: CatchupWidgetRow[];
  /** Items waiting (quiet lines are listed, never counted). */
  count: number;
  /** Rows the budget left out. */
  more: number;
};

const HOME_WORDS: Partial<Record<ChatCatchupItem["reason"], string>> = {
  dm: "sent you a message",
  reply: "replied in your chain",
};

export function shapeCatchupWidget(input: {
  items: readonly ChatCatchupItem[];
  messages: Readonly<Record<string, ChatMessage>>;
  channels: Readonly<Record<string, ChatChannel>>;
  unread: Readonly<Record<string, ChatUnread>>;
  people: Readonly<Record<string, ChatPerson>>;
  selfId: string;
  limit: number;
}): CatchupWidgetView {
  const { items, messages, channels, unread, people, selfId, limit } = input;
  const personOf = (id: string) => people[id];
  const messageOf = (item: ChatCatchupItem) =>
    item.messageId ? messages[item.messageId] : undefined;
  const groups = buildCatchup({
    items,
    channels,
    unread,
    selfId,
    personOf,
    authorOf: (item) => {
      const m = messageOf(item);
      return m ? authorName(m, m.authorId ? personOf(m.authorId) : undefined) : null;
    },
    order: "newest",
  });
  const all = groups.flatMap((g) => g.rows);
  const rows = all.slice(0, Math.max(0, limit)).map((row): CatchupWidgetRow => {
    const { item } = row;
    const named = row.quiet || item.reason === "every_message" || item.reason === "dm";
    const channel = channels[item.channelId];
    const conversation = channel ? (channel.kind === "channel" ? channel.name : null) : null;
    const whoId = row.quiet ? item.actorId : (messageOf(item)?.authorId ?? null);
    // Frame 8's words for a person's own lines; everything else as Catch up says it.
    const why = !row.who ? row.why : (HOME_WORDS[item.reason] ?? row.why);
    return {
      id: item.id,
      who: row.who,
      whoId: row.who ? whoId : null,
      line: !named && conversation ? `${why} · ${conversation}` : why,
      at: item.at,
      quiet: row.quiet,
    };
  });
  return {
    rows,
    count: all.filter((r) => !r.quiet).length,
    more: Math.max(0, all.length - rows.length),
  };
}
