// Chat realtime (CV-3, round-3 §2.7, CV-0 spike 3): the one adapter the store's
// live merge takes its input from.
//
// Today it is Postgres Changes, each its own client channel:
//   • chat_messages  filtered workspace_id=eq.<ws>, bound with `select` (the
//     columns the store reads: `search_tsv` and `body_text` stay off the wire;
//     a publication column list wouldn't narrow it, spike 3);
//   • chat_channels  filtered workspace_id=eq.<ws>;
//   • chat_members   filtered to you;
//   • chat_catchup   filtered to you.
// Realtime applies each subscriber's read rules. It is latency, never truth:
// every join (and every rejoin) says `joined` only once Realtime answers
// "Subscribed to PostgreSQL", and the store fills the gap by a delta read.
// Spike 3 measured Postgres Changes missing the ≤ 500 ms delivery bar on the
// local stack (its ~0.5 s WAL poll); if the real project misses it too,
// Broadcast from the database replaces this source without touching the merge
// (decisions/chat.md BR-1).
//
// Realtime is a socket concern, not an RPC, so it sits outside the runtime
// seam and takes the Supabase client as its socket.

import type { SupabaseClient } from "@supabase/supabase-js";

import { CHAT_MESSAGE_COLUMN_LIST } from "./columns";
import { mapChannel, mapMember, mapMessage, memberLeft } from "./mappers";
import type { ChatChannel, ChatMember, ChatMessage } from "./model";

/** What a live source tells the store. Rows arrive whole (or as the `select` list). */
export type ChatLiveEvent =
  /** `insert`: a new message (an update is an edit, a reaction, a delete, a move). */
  | { type: "message"; row: ChatMessage; insert: boolean }
  /** A hard delete carries only the primary key: the store ignores ids it doesn't hold. */
  | { type: "message-gone"; id: string }
  | { type: "channel"; channel: ChatChannel }
  | { type: "channel-gone"; id: string }
  | { type: "member"; member: ChatMember }
  /** One of your membership rows was stamped `left_at` (or deleted). */
  | { type: "member-left"; channelId: string }
  | { type: "catchup" }
  /** A (re)join is complete: fill the gap. */
  | { type: "joined"; source: string }
  /** A source dropped (error, timeout, close): Phoenix rejoins by itself. */
  | { type: "lost"; source: string };

export type ChatLiveSource = (
  scope: { workspaceId: string; userId: string },
  sink: (event: ChatLiveEvent) => void,
) => () => void;

/** The part of the Supabase client the live layer uses. */
export type ChatSocket = Pick<SupabaseClient, "channel" | "removeChannel">;

type Payload = { eventType?: string; new?: unknown; old?: unknown };
type Channel = ReturnType<ChatSocket["channel"]>;

// realtime-js hands back the channel that is still leaving when a topic is
// asked for again before its leave finished, and subscribing to that one does
// nothing: a quick release-and-hold (a switch back, a remount) would end with
// no live channel. A named topic (typing, presence) joins again once it left.
const leaving = new WeakMap<ChatSocket, Map<string, Promise<void>>>();

/** Leave a topic; joining it again through `whenTopicFree` waits for this. */
export function leaveTopic(socket: ChatSocket, topic: string, channel: Channel): void {
  let topics = leaving.get(socket);
  if (!topics) {
    topics = new Map();
    leaving.set(socket, topics);
  }
  const map = topics;
  const done: Promise<void> = Promise.resolve(socket.removeChannel(channel))
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      if (map.get(topic) === done) map.delete(topic);
    });
  map.set(topic, done);
}

/** Run `join` once no earlier channel on the topic is still leaving (at once when none is). */
export function whenTopicFree(socket: ChatSocket, topic: string, join: () => void): void {
  const wait = leaving.get(socket)?.get(topic);
  if (wait) void wait.then(join);
  else join();
}

/** Each live source's channels get their own topics (they name nothing shared). */
let generation = 0;

const str = (v: unknown) => (typeof v === "string" ? v : null);
const field = (row: unknown, key: string) =>
  row && typeof row === "object" ? str((row as Record<string, unknown>)[key]) : null;

/** Postgres Changes as the store's live source. */
export function postgresChangesSource(socket: ChatSocket): ChatLiveSource {
  return ({ workspaceId: ws, userId: me }, sink) => {
    const bindings: {
      name: string;
      table: string;
      filter: string;
      select?: readonly string[];
      on: (p: Payload) => void;
    }[] = [
      {
        name: "messages",
        table: "chat_messages",
        filter: `workspace_id=eq.${ws}`,
        select: CHAT_MESSAGE_COLUMN_LIST,
        on: (p) => {
          if (p.eventType === "DELETE") {
            const id = field(p.old, "id");
            if (id) sink({ type: "message-gone", id });
            return;
          }
          const row = mapMessage(p.new);
          if (row) sink({ type: "message", row, insert: p.eventType === "INSERT" });
        },
      },
      {
        name: "channels",
        table: "chat_channels",
        filter: `workspace_id=eq.${ws}`,
        on: (p) => {
          if (p.eventType === "DELETE") {
            const id = field(p.old, "id");
            if (id) sink({ type: "channel-gone", id });
            return;
          }
          const channel = mapChannel(p.new);
          if (!channel) return;
          if (field(p.new, "deleted_at")) sink({ type: "channel-gone", id: channel.id });
          else sink({ type: "channel", channel });
        },
      },
      {
        name: "members",
        table: "chat_members",
        filter: `user_id=eq.${me}`,
        on: (p) => {
          // A removed row carries only its key, the row's own id (CV-22), so it
          // says nothing about anyone and is ignored: leaving and removal stamp
          // `left_at` (an update), and a deleted conversation arrives on
          // chat_channels.
          if (p.eventType === "DELETE") return;
          const row = p.new;
          const channelId = field(row, "channel_id");
          if (!channelId) return;
          if (field(row, "user_id") !== me) return;
          if (field(row, "workspace_id") !== ws) return;
          if (memberLeft(row)) {
            sink({ type: "member-left", channelId });
            return;
          }
          const member = mapMember(row);
          if (member && member.workspaceId === ws) sink({ type: "member", member });
        },
      },
      {
        name: "catchup",
        table: "chat_catchup",
        filter: `user_id=eq.${me}`,
        on: (p) => {
          // Only this workspace's rows recount it. A delete carries only the
          // key (no workspace): an extra recount is harmless, so it passes.
          if (p.eventType !== "DELETE" && field(p.new, "workspace_id") !== ws) return;
          sink({ type: "catchup" });
        },
      },
    ];

    const n = ++generation;
    const channels = bindings.map((b) => {
      const channel = socket.channel(`chat-${b.name}:${ws}:${me}:${n}`);
      // The installed realtime-js types don't name `select`; the server reads it
      // (realtime.subscription.selected_columns, spike 3).
      const binding = {
        event: "*",
        schema: "public",
        table: b.table,
        filter: b.filter,
        ...(b.select ? { select: [...b.select] } : {}),
      };
      channel
        .on("postgres_changes", binding as never, (payload: Payload) => b.on(payload))
        .on("system", {}, (msg: { extension?: string; status?: string }) => {
          if (msg?.extension !== "postgres_changes") return;
          if (msg.status === "ok") sink({ type: "joined", source: b.name });
          else sink({ type: "lost", source: b.name });
        })
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            sink({ type: "lost", source: b.name });
          }
        });
      return channel;
    });

    return () => {
      for (const channel of channels) void socket.removeChannel(channel);
    };
  };
}
