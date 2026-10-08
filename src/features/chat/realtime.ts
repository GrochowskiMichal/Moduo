// Chat realtime — one shared connection per workspace (specs/chat.md §Realtime).
//
// Two Supabase channels, ref-counted so the nav badge (always mounted in the
// app chrome) and the Chat page share them instead of opening duplicates:
//
//   • `chat-db:<ws>`  postgres_changes on chat_messages / chat_channels (per
//     workspace) and chat_members (mine). Realtime applies the subscriber's RLS,
//     so private channels and DMs never leak; deletes are soft for that reason.
//   • `chat:<ws>`     PRIVATE broadcast + presence (typing, who's online),
//     authorized by the realtime.messages policies in the chat migration.
//
// Realtime is a latency layer, not the source of truth: after a reconnect (or
// a long sleep) listeners get a `resync` and refetch what they show — a missed
// event can never become a missing message.
//
// Like notes realtime (NO-6) this imports the Supabase client directly:
// Realtime is a socket concern, not an RPC, so it sits outside the runtime seam.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseClient } from "@/lib/runtime.web";
import { mapChannel, mapMember, mapMessage } from "./mappers";
import type { ChatChannel, ChatMember, ChatMessage } from "./model";

export type ChatDbEvent =
  | { type: "message"; message: ChatMessage; isInsert: boolean }
  | { type: "channel"; channel: ChatChannel }
  | { type: "membership"; member: ChatMember }
  | { type: "membership-removed"; channelId: string }
  | { type: "resync" };

export type TypingEntry = {
  userId: string;
  channelId: string;
  parentId: string | null;
  until: number;
};

type Listener = (event: ChatDbEvent) => void;

const TYPING_TTL_MS = 4_000;
const TYPING_THROTTLE_MS = 2_500;
/** Coming back after this long hidden refetches, even if the socket says it's fine. */
const STALE_AFTER_HIDDEN_MS = 60_000;

class WorkspaceLink {
  private refs = 0;
  private db: RealtimeChannel | null = null;
  private live: RealtimeChannel | null = null;
  private listeners = new Set<Listener>();
  private presenceSubs = new Set<() => void>();
  private typingSubs = new Set<() => void>();
  private online: ReadonlySet<string> = new Set();
  private typing: TypingEntry[] = [];
  private livePushable = false;
  private dbJoinedOnce = false;
  private lastTypingSent = new Map<string, number>();
  private typingSweep: ReturnType<typeof setInterval> | null = null;
  private hiddenAt: number | null = null;

  constructor(
    readonly workspaceId: string,
    readonly selfId: string,
  ) {}

  acquire(): void {
    this.refs += 1;
    if (this.refs === 1) this.open();
  }

  release(): void {
    this.refs -= 1;
    if (this.refs <= 0) this.close();
  }

  get refCount(): number {
    return this.refs;
  }

  private open(): void {
    const ws = this.workspaceId;
    const db = supabaseClient.channel(`chat-db:${ws}:${this.selfId}`);
    db.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "chat_messages", filter: `workspace_id=eq.${ws}` },
      (payload) => {
        const message = mapMessage(payload.new);
        if (message)
          this.emit({ type: "message", message, isInsert: payload.eventType === "INSERT" });
      },
    )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_channels", filter: `workspace_id=eq.${ws}` },
        (payload) => {
          const channel = mapChannel(payload.new);
          if (channel) this.emit({ type: "channel", channel });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_members",
          filter: `user_id=eq.${this.selfId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const channelId = (payload.old as { channel_id?: unknown })?.channel_id;
            if (typeof channelId === "string") this.emit({ type: "membership-removed", channelId });
            return;
          }
          const member = mapMember(payload.new);
          if (member && member.workspaceId === ws) this.emit({ type: "membership", member });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // The first join is the initial load's job; every later join is a
          // reconnect that may have missed events.
          if (this.dbJoinedOnce) this.emit({ type: "resync" });
          this.dbJoinedOnce = true;
        }
      });
    this.db = db;

    const live = supabaseClient.channel(`chat:${ws}`, {
      config: { private: true, broadcast: { self: false }, presence: { key: this.selfId } },
    });
    live
      .on("presence", { event: "sync" }, () => {
        this.online = new Set(Object.keys(live.presenceState()));
        for (const fn of this.presenceSubs) fn();
      })
      .on("broadcast", { event: "typing" }, (msg) => {
        const p = msg.payload as Partial<TypingEntry> & { stop?: boolean };
        if (typeof p?.userId !== "string" || typeof p.channelId !== "string") return;
        if (p.userId === this.selfId) return;
        this.typing = this.typing.filter(
          (t) =>
            !(
              t.userId === p.userId &&
              t.channelId === p.channelId &&
              t.parentId === (p.parentId ?? null)
            ),
        );
        if (!p.stop) {
          this.typing.push({
            userId: p.userId,
            channelId: p.channelId,
            parentId: p.parentId ?? null,
            until: Date.now() + TYPING_TTL_MS,
          });
        }
        for (const fn of this.typingSubs) fn();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          this.livePushable = true;
          void live.track({ at: new Date().toISOString() });
        } else {
          this.livePushable = false;
        }
      });
    this.live = live;

    this.typingSweep = setInterval(() => {
      const now = Date.now();
      const before = this.typing.length;
      this.typing = this.typing.filter((t) => t.until > now);
      if (this.typing.length !== before) for (const fn of this.typingSubs) fn();
    }, 1_000);

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    if (typeof window !== "undefined") window.addEventListener("online", this.onOnline);
  }

  private close(): void {
    if (this.db) void supabaseClient.removeChannel(this.db);
    if (this.live) void supabaseClient.removeChannel(this.live);
    this.db = null;
    this.live = null;
    this.livePushable = false;
    this.dbJoinedOnce = false;
    this.online = new Set();
    this.typing = [];
    if (this.typingSweep) clearInterval(this.typingSweep);
    this.typingSweep = null;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    if (typeof window !== "undefined") window.removeEventListener("online", this.onOnline);
  }

  private onVisibility = () => {
    if (document.visibilityState === "hidden") {
      this.hiddenAt = Date.now();
      return;
    }
    if (this.hiddenAt && Date.now() - this.hiddenAt > STALE_AFTER_HIDDEN_MS) {
      this.emit({ type: "resync" });
    }
    this.hiddenAt = null;
  };

  private onOnline = () => this.emit({ type: "resync" });

  private emit(event: ChatDbEvent): void {
    for (const fn of this.listeners) fn(event);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ── presence ──
  subscribePresence = (fn: () => void) => {
    this.presenceSubs.add(fn);
    return () => this.presenceSubs.delete(fn);
  };
  getOnline = (): ReadonlySet<string> => this.online;

  // ── typing ──
  subscribeTyping = (fn: () => void) => {
    this.typingSubs.add(fn);
    return () => this.typingSubs.delete(fn);
  };
  getTyping = (): TypingEntry[] => this.typing;

  /** Throttled "I'm typing" — `stop` clears it immediately on send/blur. */
  sendTyping(channelId: string, parentId: string | null, stop = false): void {
    // `send()` on an un-joined channel REST-falls-back (gotchas §Realtime) — drop instead.
    if (!this.live || !this.livePushable) return;
    const key = `${channelId}:${parentId ?? ""}`;
    const now = Date.now();
    if (!stop && now - (this.lastTypingSent.get(key) ?? 0) < TYPING_THROTTLE_MS) return;
    if (stop && !this.lastTypingSent.has(key)) return;
    if (stop) this.lastTypingSent.delete(key);
    else this.lastTypingSent.set(key, now);
    void this.live.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: this.selfId, channelId, parentId, stop },
    });
  }
}

const links = new Map<string, WorkspaceLink>();

/**
 * Get (and hold) the shared realtime link for a workspace. Call the returned
 * release on unmount; the sockets close when the last holder lets go.
 */
export function acquireChatLink(
  workspaceId: string,
  selfId: string,
): {
  link: WorkspaceLink;
  release: () => void;
} {
  const key = `${workspaceId}:${selfId}`;
  let link = links.get(key);
  if (!link) {
    link = new WorkspaceLink(workspaceId, selfId);
    links.set(key, link);
  }
  link.acquire();
  const held = link;
  let released = false;
  return {
    link: held,
    release: () => {
      if (released) return;
      released = true;
      held.release();
      if (held.refCount <= 0) links.delete(key);
    },
  };
}

export type ChatLink = WorkspaceLink;

/** Cross-surface nudge: the page tells the badge "read state changed, recount". */
export const CHAT_READ_CHANGED_EVENT = "moduo:chat:read-changed";
export function dispatchChatReadChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CHAT_READ_CHANGED_EVENT));
}
