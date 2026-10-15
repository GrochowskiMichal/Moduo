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
          const row = p.eventType === "DELETE" ? p.old : p.new;
          const channelId = field(row, "channel_id");
          if (!channelId) return;
          if (p.eventType === "DELETE" || memberLeft(row)) {
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
        on: () => sink({ type: "catchup" }),
      },
    ];

    const channels = bindings.map((b) => {
      const channel = socket.channel(`chat-${b.name}:${ws}:${me}`);
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
